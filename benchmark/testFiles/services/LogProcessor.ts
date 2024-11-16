import fs from 'fs';

export class LogProcessor {
    private logFile = '/var/log/app.log';
    
    async processLogs() {
        const logs = await fs.promises.readFile(this.logFile, 'utf8');
        const entries = logs.split('\n');
        
        let processedEntries = [];
        for(let entry of entries) {
            try {
                const parsed = JSON.parse(entry);
                processedEntries.push(parsed);
            } catch {
                continue;
            }
        }
        
        return processedEntries;
    }

    async clearLogs() {
        await fs.promises.writeFile(this.logFile, '');
    }
} 