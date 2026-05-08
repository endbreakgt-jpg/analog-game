export class GameLogger {
    constructor() {
        this.logs = [];
        this.onLogAdded = null;
        this.consoleEnabled = true;
    }

    log(message, data = null) {
        const now = new Date();
        const entry = {
            timestamp: now.toISOString(),
            time: now.toLocaleTimeString(),
            message,
            data
        };
        this.logs.push(entry);
        if (this.onLogAdded) {
            this.onLogAdded(entry);
        }
        // コンソールにも吐き出しておく（後で抽出・分析しやすいように）
        if (this.consoleEnabled) {
            if (data) {
                console.log(`[LOG] ${message}`, data);
            } else {
                console.log(`[LOG] ${message}`);
            }
        }
    }

    clear() {
        this.logs = [];
    }

    exportLogs() {
        return JSON.stringify(this.logs, null, 2);
    }
}

export const logger = new GameLogger();
