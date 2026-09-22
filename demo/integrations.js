// Local stubs: these functions never use a provider, filesystem credential, or network.
export const integrationStatus = Object.freeze({
  preview: "stubbed",
  cloudStorage: "excluded",
  todoist: "excluded",
  ai: "excluded",
  jobAlerts: "excluded",
  notifications: "excluded",
  catalogImports: "excluded",
});
export function previewStub() {
  return {
    available: false,
    message: "Preview unavailable in this local sample. Your save still works.",
  };
}
