import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BottomNav from "../src/components/BottomNav";

// matchMedia is mocked to matches:false in test/setup.ts → mobile bottom-bar layout.
describe("BottomNav (mobile bar)", () => {
  it("renders the primary tabs + More and routes on tap", () => {
    const onNav = vi.fn();
    render(<BottomNav currentPage="work" onNavigate={onNav} />);
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Canvas")).toBeInTheDocument();
    expect(screen.getByText("More")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Canvas"));
    expect(onNav).toHaveBeenCalledWith("canvas");
  });

  it("opens the More sheet to reach secondary pages", () => {
    const onNav = vi.fn();
    render(<BottomNav currentPage="work" onNavigate={onNav} />);
    fireEvent.click(screen.getByText("More"));
    fireEvent.click(screen.getByText("Toolkit"));
    expect(onNav).toHaveBeenCalledWith("toolkit");
  });
});
