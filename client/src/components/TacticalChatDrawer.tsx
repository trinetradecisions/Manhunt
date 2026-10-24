'use client';

import { useState, useRef, useEffect } from 'react';
import {
  MessageSquare,
  Send,
  X,
  Users,
  Shield,
  Radio,
  Lock,
  Hash,
} from 'lucide-react';
import { ChatMessage, ChatRecipientType, RoomState } from '../types/game';

interface TacticalChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  roomState: RoomState;
  myPlayerId: string;
  messages: ChatMessage[];
  channelMessages?: Record<string, ChatMessage[]>;
  activeChatChannel?: string;
  unreadByChannel?: Record<string, number>;
  onSelectChatChannel?: (channelId: string) => void;
  onSendMessage: (
    channelOrType: string,
    text: string,
    recipientId?: string
  ) => void;
}

export default function TacticalChatDrawer({
  isOpen,
  onClose,
  roomState,
  myPlayerId,
  messages,
  channelMessages = {},
  activeChatChannel = 'PUBLIC',
  unreadByChannel = {},
  onSelectChatChannel,
  onSendMessage,
}: TacticalChatDrawerProps) {
  const [selectedChannel, setSelectedChannel] = useState<string>(activeChatChannel);
  const [targetPlayerId, setTargetPlayerId] = useState<string>('');
  const [inputVal, setInputVal] = useState<string>('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const myMember = roomState.members[myPlayerId];

  // Sync active channel
  useEffect(() => {
    if (activeChatChannel) {
      setSelectedChannel(activeChatChannel);
    }
  }, [activeChatChannel]);

  const activeMessages =
    channelMessages[selectedChannel] ||
    messages.filter((m) => {
      if (selectedChannel === 'PUBLIC') return m.recipientType === 'ALL';
      if (selectedChannel === 'SQUAD') return m.recipientType === 'TEAM';
      if (selectedChannel.startsWith('DM:')) return m.recipientType === 'DIRECT';
      return false;
    });

  // Auto-scroll to latest message
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeMessages.length, isOpen]);

  if (!isOpen) return null;

  const otherMembers = Object.values(roomState.members).filter(
    (m) => m.id !== myPlayerId
  );

  const handleChannelClick = (ch: string) => {
    setSelectedChannel(ch);
    if (onSelectChatChannel) {
      onSelectChatChannel(ch);
    }
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim()) return;

    onSendMessage(
      selectedChannel,
      inputVal.trim(),
      selectedChannel.startsWith('DM:') ? selectedChannel.slice(3) : undefined
    );
    setInputVal('');
  };

  return (
    <div className="fixed inset-0 z-[700] bg-black/70 backdrop-blur-sm flex justify-end sm:p-4 select-none">
      <div className="w-full sm:max-w-md h-[85dvh] max-h-[85dvh] sm:h-[650px] bg-[#1F2731] border border-[#3B4652] sm:rounded-3xl flex flex-col shadow-2xl mt-auto sm:my-auto overflow-hidden pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {/* Header */}
        <div className="p-4 border-b border-[#3B4652] flex items-center justify-between bg-[#293440]">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-[#FF4655]" />
            <h3 className="font-mono font-bold text-xs uppercase tracking-wider text-white">
              Tactical Comms Channel
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[#3B4652] text-[#A8B0BA] hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Channel Navigation Buttons */}
        <div className="px-4 py-2.5 bg-[#161e27] border-b border-[#3B4652] flex flex-col gap-2">
          <div className="flex gap-1.5">
            <button
              onClick={() => handleChannelClick('PUBLIC')}
              className={`flex-1 py-1.5 rounded-xl font-mono text-[10px] font-bold uppercase transition-all flex items-center justify-center gap-1 border ${
                selectedChannel === 'PUBLIC'
                  ? 'bg-[#293440] border-[#3B4652] text-white'
                  : 'bg-[#1F2731] border-[#3B4652] text-[#A8B0BA]'
              }`}
            >
              <Hash className="w-3 h-3" />
              <span>Public</span>
            </button>

            {myMember?.team !== 'NONE' && (
              <button
                onClick={() => handleChannelClick('SQUAD')}
                className={`flex-1 py-1.5 rounded-xl font-mono text-[10px] font-bold uppercase transition-all flex items-center justify-center gap-1 border ${
                  selectedChannel === 'SQUAD'
                    ? myMember?.team === 'RUNNERS'
                      ? 'bg-[#39BDE8]/20 border-[#39BDE8] text-[#39BDE8]'
                      : 'bg-[#FF4655]/20 border-[#FF4655] text-[#FF4655]'
                    : 'bg-[#1F2731] border-[#3B4652] text-[#A8B0BA]'
                }`}
              >
                <Shield className="w-3 h-3" />
                <span>Squad Comms</span>
              </button>
            )}
          </div>
        </div>

        {/* Message Feed */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3 font-mono text-xs">
          {activeMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-[#A8B0BA] text-[11px] space-y-2">
              <Radio className="w-6 h-6 text-[#A8B0BA]/50" />
              <p>Channel #{selectedChannel.toLowerCase()} is open. No transmissions recorded yet.</p>
            </div>
          ) : (
            activeMessages.map((m) => {
              const isMe = m.senderId === myPlayerId;
              const senderAccent =
                m.senderTeam === 'RUNNERS'
                  ? 'text-[#39BDE8]'
                  : m.senderTeam === 'CHASERS'
                  ? 'text-[#FF4655]'
                  : 'text-[#A8B0BA]';

              return (
                <div
                  key={m.id}
                  className={`flex flex-col gap-1 max-w-[85%] ${
                    isMe ? 'ml-auto items-end' : 'mr-auto items-start'
                  }`}
                >
                  <div className="flex items-center gap-2 text-[10px] text-[#A8B0BA]">
                    <span className={`font-bold ${senderAccent}`}>
                      {m.senderNickname} {isMe && '(You)'}
                    </span>
                    <span className="text-[9px]">
                      {new Date(m.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <div
                    className={`p-3 rounded-2xl break-words [overflow-wrap:anywhere] leading-relaxed max-w-[90%] ${
                      isMe
                        ? 'bg-[#FF4655] text-white'
                        : 'bg-[#293440] text-[#ECE8E1] border border-[#3B4652]'
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <form
          onSubmit={handleSend}
          className="p-3 border-t border-[#3B4652] bg-[#293440] flex gap-2"
        >
          <input
            type="text"
            value={inputVal}
            maxLength={300}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder={`Message #${selectedChannel.toLowerCase()}...`}
            className="flex-1 min-w-0 bg-[#1F2731] border border-[#3B4652] rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-[#FF4655]"
          />
          <button
            type="submit"
            disabled={!inputVal.trim()}
            className="px-4 py-2 bg-[#FF4655] hover:brightness-110 active:scale-95 disabled:opacity-40 text-white font-bold rounded-xl text-xs flex items-center justify-center transition-all shadow shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
