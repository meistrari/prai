export class DataTransformer {
    static async transformUserData(data: any) {
        let result = {};
        
        for(let key in data) {
            if(data[key]) {
                result[key] = data[key].toString();
            }
        }
        
        return result;
    }

    static async processLargeDataset(items: any[]) {
        const results = [];
        for(let item of items) {
            results.push(await this.transformUserData(item));
        }
        return results;
    }
} 