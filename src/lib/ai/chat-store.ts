import { randomBytes } from "node:crypto";
import path from "node:path";

import { projectDir, readJson, writeJson } from "@/lib/cloner/storage";
import type { ChatMessage } from "@/types/project";

const MAX_STORED_MESSAGES = 200;

function chatPath(projectId: string): string {
  return path.join(projectDir(projectId), "chat.json");
}

export function newMessage(
  role: ChatMessage["role"],
  text: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`,
    role,
    text,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

export async function readChat(projectId: string): Promise<ChatMessage[]> {
  return (await readJson<ChatMessage[]>(chatPath(projectId))) ?? [];
}

export async function appendChat(projectId: string, messages: ChatMessage[]): Promise<void> {
  const existing = await readChat(projectId);
  await writeJson(chatPath(projectId), [...existing, ...messages].slice(-MAX_STORED_MESSAGES));
}
