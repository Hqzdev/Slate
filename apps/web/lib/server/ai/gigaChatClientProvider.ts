import { GigaChatClient, loadGigaChatConfig } from "./gigaChatClient";

let gigaChatClient: GigaChatClient | null = null;

export function getGigaChatClient() {
  if (!gigaChatClient) gigaChatClient = new GigaChatClient(loadGigaChatConfig());
  return gigaChatClient;
}
