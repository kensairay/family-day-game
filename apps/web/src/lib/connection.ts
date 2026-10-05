export interface ServerMessage { type: string; [key: string]: unknown }
export class RoomConnection {
  private socket?: WebSocket;
  private heartbeat?: ReturnType<typeof setInterval>;
  private reconnect?: ReturnType<typeof setTimeout>;
  private initialState?: ReturnType<typeof setTimeout>;
  private diagnostic?: AbortController;
  private stopped = false;
  private attempts = 0;
  constructor(private room: string, private credential: string, private receive: (msg: ServerMessage) => void, private status: (online: boolean, text: string) => void) {}
  open() {
    if (this.stopped) return;
    const url = new URL(`/api/rooms/${this.room}/socket`, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, ['family.v1', `auth.${this.credential}`]); this.socket = socket;
    let connectedAt = 0, ready = false;
    this.status(false, '連線中…');
    this.initialState = setTimeout(() => {
      if (!this.stopped && this.socket === socket && !ready) socket.close();
    }, 10_000);
    socket.onopen = () => {
      if (this.stopped || this.socket !== socket) return;
      connectedAt = Date.now(); this.status(false, '已連線，讀取房間狀態中…');
      this.send({ protocol: 1, type: 'state.sync' });
      this.heartbeat = setInterval(() => this.send({ protocol: 1, type: 'ping' }), 25_000);
    };
    socket.onmessage = event => {
      if (this.stopped || this.socket !== socket) return;
      let msg: ServerMessage;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;
      if ((msg.type.startsWith('session.') && msg.type !== 'session.left') || msg.type === 'room.closed') {
        const text = msg.type === 'session.replaced' ? '此身分已在其他分頁連線，這個分頁已停止重連。'
          : msg.type === 'session.throttled' ? '操作太頻繁，請等候一分鐘後重新整理。' : '房間或憑證已關閉、到期或撤銷。';
        this.stop(); this.status(false, text); return;
      }
      if (msg.type === 'state.snapshot' && !ready) {
        ready = true; clearTimeout(this.initialState); this.status(true, '已連線');
      }
      this.receive(msg);
    };
    socket.onclose = async event => {
      if (this.socket !== socket) return;
      clearInterval(this.heartbeat); clearTimeout(this.initialState);
      if (this.stopped) return;
      if (event.code === 4001 || event.code === 4003) { this.stop(); this.status(false, '工作階段已結束，請重新確認房間。'); return; }
      // A failed handshake has no connectedAt. Only a stable connection earns
      // a new retry budget; otherwise failures must eventually stop.
      if (connectedAt > 0 && ready && Date.now() - connectedAt > 60_000) this.attempts = 0;
      this.status(false, '連線中斷，正在檢查房間…');
      const diagnostic = await this.checkConnection();
      if (this.stopped || this.socket !== socket) return;
      if (diagnostic.terminal) { this.stop(); this.status(false, diagnostic.text); return; }
      if (this.attempts >= 5) {
        this.status(false, diagnostic.valid ? '房間與身分有效，但即時連線未成功。請改用手機網路或其他網路後，在此分頁重新整理；身分會保留。' : '無法恢復連線。請確認網路後，在此分頁重新整理；身分會保留。');
        return;
      }
      this.status(false, diagnostic.valid ? '房間與身分有效，正在重新連線…' : '連線中斷，正在重新連線…');
      this.reconnect = setTimeout(() => this.open(), Math.min(30_000, 2000 * 2 ** this.attempts++) + Math.random() * 1000);
    };
    socket.onerror = () => { if (!this.stopped && this.socket === socket) this.status(false, '連線失敗，正在確認房間與網路…'); };
  }
  private async checkConnection(): Promise<{ terminal?: boolean; valid?: boolean; text: string }> {
    this.diagnostic = new AbortController();
    const timeout = setTimeout(() => this.diagnostic?.abort(), 5000);
    try {
      // Never put credentials in URLs or diagnostics. The response contains
      // only validity/role, no state, questions, answers, or player data.
      const response = await fetch(`/api/rooms/${this.room}/connection`, {
        method: 'POST', headers: { Authorization: `Bearer ${this.credential}` }, signal: this.diagnostic.signal,
      });
      const terminal: Record<number, string> = {
        401: '此分頁的連線憑證已失效，請從主持人入口建立房間，或從玩家加入頁重新加入。',
        403: '連線來源驗證失敗，請在本站原本的分頁重新整理。',
        404: '房間不存在或已到期，請從主持人入口建立新房間。',
        409: '遊戲已開始，這個玩家尚未完成加入，請洽主持人。',
        410: '房間已關閉或到期，請從主持人入口建立新房間。',
        429: '連線嘗試太頻繁，請等候一分鐘後在此分頁重新整理。',
      };
      if (terminal[response.status]) return { terminal: true, text: terminal[response.status] };
      return { valid: response.ok, text: '' };
    } catch { return { text: '' }; }
    finally { clearTimeout(timeout); }
  }
  send(message: unknown): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message)); return true;
  }
  stop() {
    this.stopped = true; clearInterval(this.heartbeat); clearTimeout(this.reconnect); clearTimeout(this.initialState); this.diagnostic?.abort();
    this.send({ protocol: 1, type: 'session.leave' }); this.socket?.close();
  }
}
