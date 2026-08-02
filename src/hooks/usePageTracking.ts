// src/hooks/usePageTracking.js — tracks page dwell time for beta analytics
// PLACE IN: /src/hooks/usePageTracking.js (create hooks folder if it doesn't exist)

import { useEffect, useRef } from "react";
import { supabase } from "../api/supabase";

export function usePageTracking(page, userId) {
  const enteredAt = useRef(null);
  const rowId     = useRef(null);

  useEffect(() => {
    if (!page || !userId) return;

    enteredAt.current = new Date().toISOString();
    rowId.current     = null;

    // Insert row when user enters page
    supabase
      .from("beta_sessions")
      .insert({ user_id: userId, page, entered_at: enteredAt.current })
      .select("id")
      .single()
      .then(({ data }) => {
        if (data?.id) rowId.current = data.id;
      });

    // Update with exit time + duration when user leaves
    return () => {
      if (!rowId.current) return;
      const durationSeconds = Math.round(
        (Date.now() - new Date(enteredAt.current).getTime()) / 1000
      );
      // Use sendBeacon-style fire-and-forget so it works on tab close too
      supabase
        .from("beta_sessions")
        .update({ exited_at: new Date().toISOString(), duration_seconds: durationSeconds })
        .eq("id", rowId.current)
        .then(() => {});
    };
  }, [page, userId]);
}
