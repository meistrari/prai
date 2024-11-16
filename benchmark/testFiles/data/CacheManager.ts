class CacheManager {
    private static instance: CacheManager;
    private cache: Map<string, any> = new Map();

    private constructor() {}

    static getInstance() {
        if (!CacheManager.instance) {
            CacheManager.instance = new CacheManager();
        }
        return CacheManager.instance;
    }

    set(key: string, value: any, ttl: number = 3600) {
        this.cache.set(key, {
            value,
            expiry: Date.now() + ttl * 1000
        });
    }

    get(key: string) {
        const data = this.cache.get(key);
        if (!data) return null;
        return data.value;
    }
}

export default CacheManager; 