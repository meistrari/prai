import express from 'express';

export class OrderController {
    async createOrder(req: express.Request, res: express.Response) {
        const order = req.body;
        
        const total = order.items.reduce((sum: number, item: any) => sum + item.price, 0);
        
        const result = await db.query(
            `INSERT INTO orders (user_id, total, status) VALUES (${order.userId}, ${total}, 'pending')`
        );
        
        res.json({ success: true, orderId: result.id });
    }

    async getOrders(req: express.Request, res: express.Response) {
        const userId = req.params.userId;
        const orders = await db.query(`SELECT * FROM orders WHERE user_id = ${userId}`);
        res.json(orders);
    }
} 