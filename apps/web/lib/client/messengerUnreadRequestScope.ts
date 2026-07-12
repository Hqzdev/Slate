export type MessengerUnreadRequest = {
  controller: AbortController;
  sequence: number;
};

export class MessengerUnreadRequestScope {
  private controller: AbortController | null = null;
  private enabled = false;
  private sequence = 0;

  constructor(readonly workspaceId: string | null) {}

  activate() {
    this.enabled = true;
  }

  deactivate() {
    this.enabled = false;
    this.sequence += 1;
    this.controller?.abort();
    this.controller = null;
  }

  begin() {
    if (!this.enabled || !this.workspaceId) return null;
    this.sequence += 1;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    return { controller, sequence: this.sequence } satisfies MessengerUnreadRequest;
  }

  isCurrent(request: MessengerUnreadRequest) {
    return this.enabled
      && this.sequence === request.sequence
      && this.controller === request.controller
      && !request.controller.signal.aborted;
  }

  finish(request: MessengerUnreadRequest) {
    if (this.sequence === request.sequence && this.controller === request.controller) {
      this.controller = null;
    }
  }
}
