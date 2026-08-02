/**
 * course-resolver.js
 * Canonical course identity resolver — used by all 3 ingestion paths:
 *   1. Canvas API sync (canvasSync.js)
 *   2. Browser extension (extension-content.js)
 *   3. Manual upload (future)
 *
 * Problem it solves (H4 bug):
 *   - Canvas API sync uses numeric canvas_course_id (e.g. "423038")
 *   - Extension scrape uses derived text code (e.g. "GGRC25H3")
 *   - Same course was getting two rows in course_content
 *
 * Resolution strategy (in priority order):
 *   1. Match by canvas_course_id (numeric) — most reliable
 *   2. Match by course_code prefix (e.g. "GGRC25H3" from "GGRC25H3 F LEC01 20265:...")
 *   3. Match by fuzzy name similarity (fallback)
 *   4. Return null if no match (caller decides whether to create)
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Normalize a course code string to its base prefix.
 * "GGRC25H3 F LEC01 20265:Land Reform" → "GGRC25H3"
 * "VPAC16H3 F LEC01" → "VPAC16H3"
 * "GGRC25H3" → "GGRC25H3"
 */
export function normalizeCourseCode(raw) {
  if (!raw) return null;
  // Extract the leading alphanumeric course code (e.g. GGRC25H3, CPS420, CMTH108)
  const match = raw.trim().match(/^([A-Z]{2,6}\s*\d{1,4}[A-Z0-9]*)/i);
  return match ? match[1].replace(/\s+/g, "").toUpperCase() : null;
}

/**
 * Resolve a canonical courses.id for a given set of identifiers.
 *
 * @param {object} params
 * @param {string} params.userId - The user's UUID
 * @param {string|null} params.canvasCourseId - Numeric Canvas course ID (e.g. "423038")
 * @param {string|null} params.courseCode - Raw course code string (e.g. "GGRC25H3 F LEC01")
 * @param {string|null} params.courseName - Full course name (fallback)
 * @returns {Promise<number|null>} The canonical courses.id, or null if not found
 */
export async function resolveCanonicalCourseId({ userId, canvasCourseId, courseCode, courseName }) {
  if (!userId) return null;

  // Strategy 1: Match by canvas_course_id (most reliable)
  if (canvasCourseId) {
    const { data, error } = await supabase
      .from("courses")
      .select("id")
      .eq("user_id", userId)
      .eq("canvas_course_id", String(canvasCourseId))
      .limit(1)
      .single();

    if (!error && data) {
      return data.id;
    }
  }

  // Strategy 2: Match by normalized course code prefix
  const normalizedCode = normalizeCourseCode(courseCode);
  if (normalizedCode) {
    const { data, error } = await supabase
      .from("courses")
      .select("id, course_code")
      .eq("user_id", userId)
      .ilike("course_code", `${normalizedCode}%`)
      .limit(5);

    if (!error && data && data.length > 0) {
      // If multiple matches, prefer exact prefix match
      const exact = data.find(
        (r) => normalizeCourseCode(r.course_code) === normalizedCode
      );
      return (exact || data[0]).id;
    }
  }

  // Strategy 3: Fuzzy name match (last resort)
  if (courseName) {
    // Extract first 20 chars of name for partial match
    const namePrefix = courseName.trim().substring(0, 20);
    const { data, error } = await supabase
      .from("courses")
      .select("id, name")
      .eq("user_id", userId)
      .ilike("name", `%${namePrefix}%`)
      .limit(1)
      .single();

    if (!error && data) {
      return data.id;
    }
  }

  return null;
}

/**
 * Resolve course ID and also update the course record with any new info.
 * Used by extension-content.js to ensure professor and canvas_course_id are filled in.
 *
 * @param {object} params - Same as resolveCanonicalCourseId + optional professor
 * @returns {Promise<number|null>}
 */
export async function resolveAndEnrichCourse({ userId, canvasCourseId, courseCode, courseName, professor }) {
  const courseId = await resolveCanonicalCourseId({ userId, canvasCourseId, courseCode, courseName });

  if (courseId && (canvasCourseId || professor)) {
    // Backfill missing fields on the matched course
    const updates: any = {};
    if (canvasCourseId) updates.canvas_course_id = String(canvasCourseId);
    if (professor && professor.trim()) updates.professor = professor.trim();

    if (Object.keys(updates).length > 0) {
      await supabase
        .from("courses")
        .update(updates)
        .eq("id", courseId)
        .eq("user_id", userId);
    }
  }

  return courseId;
}
