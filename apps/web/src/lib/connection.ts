export interface ServerMessage { type: string; [key: string]: unknown }
export class RoomConnection {
  private socket?: WebSocket;
  private heartbeat?: ReturnType<typeof setInterval>;
  private reconnect?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private attempts = 0;
  private connectedAt = 0;
  constructor(private room: string, private credential: string, private receive: (msg: ServerMessage) => void, private status: (online: boolean, text: string) => void) {}
  open() {
    if (this.stopped) return;
    const url = new URL(`/api/rooms/${this.room}/socket`, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, ['family.v1', `auth.${this.credential}`]); this.socket = socket;
    this.status(false, '連線中…');
    socket.onopen = () => {
      this.connectedAt = Date.now(); this.status(true, '已連線');
      this.send({ protocol: 1, type: 'state.sync' });
      this.heartbeat = setInterval(() => this.send({ protocol: 1, type: 'ping' }), 25_000);
    };
    socket.onmessage = event => {
      let msg: ServerMessage;
      try { msg = JSON.parse(event.data); } catch { return; }
      if ((msg.type.startsWith('session.') && msg.type !== 'session.left') || msg.type === 'room.closed') {
        const text = msg.type === 'session.replaced' ? '此身分已在其他分頁連線，這個分頁已停止重連。'
          : msg.type === 'session.throttled' ? '操作太頻繁，請等候一分鐘後重新整理。' : '房間或憑證已關閉、到期或撤銷。';
        this.stop(); this.status(false, text); return;
      }
      this.receive(msg);
    };
    socket.onclose = event => {
      clearInterval(this.heartbeat);
      if (this.stopped) return;
      if (event.code === 4001 || event.code === 4003) { this.stop(); this.status(false, '工作階段已結束，請重新確認房間。'); return; }
      // Do not reset the retry budget for short-lived opens: avoid repeated successful handshake loops.
      if (Date.now() - this.connectedAt > 60_000) this.attempts = 0;
      if (this.attempts >= 5) { this.status(false, '連線未恢復，請稍後重新整理；身分會保留。'); return; }
      this.status(false, '連線中斷，正在重新連線…');
      this.reconnect = setTimeout(() => this.open(), Math.min(30_000, 2000 * 2 ** this.attempts++) + Math.random() * 1000);
    };
    socket.onerror = () => this.status(false, '連線失敗，請確認網路與房間。');
  }
  send(message: unknown): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message)); return true;
  }
  stop() {
    this.stopped = true; clearInterval(this.heartbeat); clearTimeout(this.reconnect);
    this.send({ protocol: 1, type: 'session.leave' }); this.socket?.close();
  }
}
