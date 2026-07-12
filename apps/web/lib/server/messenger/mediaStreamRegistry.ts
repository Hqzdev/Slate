type StreamIdentity = {
  userId: string;
  workspaceId: string;
};

export class MessengerMediaStreamRegistry {
  private readonly streams = new Map<AbortController, StreamIdentity>();

  track(
    source: ReadableStream<Uint8Array>,
    identity: StreamIdentity,
    requestSignal?: AbortSignal
  ) {
    const controller = new AbortController();
    const reader = source.getReader();
    const release = () => this.streams.delete(controller);
    const abort = () => controller.abort();
    this.streams.set(controller, identity);
    requestSignal?.addEventListener("abort", abort, { once: true });
    controller.signal.addEventListener("abort", () => void reader.cancel("access_revoked"), { once: true });
    return new ReadableStream<Uint8Array>({
      async cancel(reason) {
        release();
        requestSignal?.removeEventListener("abort", abort);
        await reader.cancel(reason);
      },
      async pull(streamController) {
        if (controller.signal.aborted) {
          release();
          requestSignal?.removeEventListener("abort", abort);
          streamController.close();
          return;
        }
        try {
          const result = await reader.read();
          if (result.done) {
            release();
            requestSignal?.removeEventListener("abort", abort);
            streamController.close();
            return;
          }
          streamController.enqueue(result.value);
        } catch (error) {
          release();
          requestSignal?.removeEventListener("abort", abort);
          streamController.error(error);
        }
      }
    });
  }

  revoke(workspaceId: string, userId: string) {
    let revoked = 0;
    for (const [controller, identity] of this.streams) {
      if (identity.workspaceId !== workspaceId || identity.userId !== userId) continue;
      controller.abort();
      this.streams.delete(controller);
      revoked += 1;
    }
    return revoked;
  }
}

export const messengerMediaStreamRegistry = new MessengerMediaStreamRegistry();
