export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  if (ms <= 0) {
    return promise;
  }

  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Operation timed out after ${String(ms)}ms`));
    }, ms);
    signal?.addEventListener(
      "abort",
      () => {
        reject(new Error(signal.reason ? String(signal.reason) : "Aborted"));
      },
      { once: true },
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
