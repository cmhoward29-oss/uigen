"use client";

import {
  createContext,
  useContext,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { useChat as useAIChat } from "@ai-sdk/react";
import type { Message } from "ai";
import { useFileSystem } from "./file-system-context";
import { setHasAnonWork } from "@/lib/anon-work-tracker";

interface ChatContextProps {
  projectId?: string;
  initialMessages?: Message[];
}

interface ChatContextType {
  messages: Message[];
  input: string;
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  status: string;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({
  children,
  projectId,
  initialMessages = [],
}: ChatContextProps & { children: ReactNode }) {
  const { fileSystem, handleToolCall } = useFileSystem();
  const [input, setInput] = useState("");
  const processedToolCallIds = useRef<Set<string>>(new Set());

  const {
    messages,
    sendMessage,
    status,
  } = useAIChat({
    api: "/api/chat",
    initialMessages,
    body: {
      files: fileSystem.serialize(),
      projectId,
    },
  });

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
    },
    []
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!input.trim()) return;
      sendMessage({ text: input });
      setInput("");
    },
    [input, sendMessage]
  );

  // Process server-executed tool results from message parts
  useEffect(() => {
    for (const message of messages) {
      if (message.role !== "assistant" || !message.parts) continue;
      for (const part of message.parts) {
        // AI SDK 5: tool parts have type "tool-{toolName}" with state "output-available"
        if (
          part.type?.startsWith("tool-") &&
          part.state === "output-available" &&
          part.toolCallId &&
          !processedToolCallIds.current.has(part.toolCallId)
        ) {
          processedToolCallIds.current.add(part.toolCallId);
          handleToolCall({
            toolName: part.type.replace(/^tool-/, ""),
            args: part.input,
          });
        }
      }
    }
  }, [messages, handleToolCall]);

  // Track anonymous work
  useEffect(() => {
    if (!projectId && messages.length > 0) {
      setHasAnonWork(messages, fileSystem.serialize());
    }
  }, [messages, fileSystem, projectId]);

  const contextValue = useMemo(
    () => ({ messages, input, handleInputChange, handleSubmit, status }),
    [messages, input, handleInputChange, handleSubmit, status]
  );

  return (
    <ChatContext.Provider value={contextValue}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
}
