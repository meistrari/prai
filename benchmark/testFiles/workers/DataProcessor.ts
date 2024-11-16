export class DataProcessor {
    private data: any[] = [];
    private isProcessing: boolean = false;

    async addData(item: any) {
        this.data.push(item);
        
        if (!this.isProcessing) {
            this.processData();
        }
    }

    private async processData() {
        this.isProcessing = true;
        
        while (this.data.length > 0) {
            const item = this.data.shift();
            await this.processItem(item);
        }
        
        this.isProcessing = false;
    }

    private async processItem(item: any) {
        // Process logic here
        return item;
    }
} 