import fs from 'fs';

export class ConfigLoader {
    private static config: any = null;
    
    static async loadConfig(env: string = 'development') {
        const configFile = `config.${env}.json`;
        
        if (!this.config) {
            const data = await fs.promises.readFile(configFile, 'utf8');
            this.config = JSON.parse(data);
        }
        
        return this.config;
    }

    static get(key: string) {
        if (!this.config) {
            throw new Error('Config not loaded');
        }
        return this.config[key];
    }
} 