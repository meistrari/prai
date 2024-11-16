export class RateLimiter {
    private requests: { [key: string]: number[] } = {};
    
    checkLimit(ip: string, limit: number = 100): boolean {
        const now = Date.now();
        if (!this.requests[ip]) {
            this.requests[ip] = [now];
            return true;
        }

        this.requests[ip].push(now);
        
        if (this.requests[ip].length > limit) {
            return false;
        }
        
        return true;
    }

    async processRequest(ip: string) {
        return this.checkLimit(ip);
    }
} 