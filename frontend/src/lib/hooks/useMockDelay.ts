export const useMockDelay = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 400));
