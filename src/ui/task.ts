export async function runWithDisplayedError(
  task: () => Promise<void>,
  showError: (message: string) => void
): Promise<void> {
  try {
    await task();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}
