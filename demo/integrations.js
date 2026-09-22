// Deliberate failure stub: no external request is made.
export const integrationStatus = Object.freeze({ preview: "stubbed" });
export function previewStub() {
  return {
    available: false,
    message: "Preview unavailable in this local sample. Your save still works.",
  };
}
