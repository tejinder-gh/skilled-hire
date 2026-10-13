import { describe, expect, it } from "vitest";
import {
  designTokens,
  Shell,
  Card,
  Status,
  Badge,
  Button,
  Field,
  Metric,
  Grid,
  Stepper,
  Divider,
  SegmentedControl,
  StarRating,
  NpsScale,
  Callout,
  ProgressBar,
  EmptyState,
  SearchBar,
  Modal,
} from "./index.js";

describe("@marketplace/ui component exports", () => {
  it("exports design tokens matching Apple HIG requirements", () => {
    expect(designTokens.ink).toBe("#0f172a");
    expect(designTokens.blue).toBe("#1d4ed8");
    expect(designTokens.green).toBe("#059669");
    expect(designTokens.amber).toBe("#d97706");
    expect(designTokens.danger).toBe("#dc2626");
    expect(designTokens.radiusXl).toBe(24);
  });

  it("exports all core and interactive Apple HIG components", () => {
    expect(typeof Shell).toBe("function");
    expect(typeof Card).toBe("function");
    expect(typeof Status).toBe("function");
    expect(typeof Badge).toBe("function");
    expect(typeof Button).toBe("function");
    expect(typeof Field).toBe("function");
    expect(typeof Metric).toBe("function");
    expect(typeof Grid).toBe("function");
    expect(typeof Stepper).toBe("function");
    expect(typeof Divider).toBe("function");
    expect(typeof SegmentedControl).toBe("function");
    expect(typeof StarRating).toBe("function");
    expect(typeof NpsScale).toBe("function");
    expect(typeof Callout).toBe("function");
    expect(typeof ProgressBar).toBe("function");
    expect(typeof EmptyState).toBe("function");
    expect(typeof SearchBar).toBe("function");
    expect(typeof Modal).toBe("function");
  });
});
