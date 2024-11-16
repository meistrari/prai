import { Database } from '../db/Database';
import { User } from '../models/User';
import * as crypto from 'crypto';

export class UserService {
    private db: Database;
    
    constructor() {
        this.db = new Database('postgres://admin:password123@localhost:5432/userdb');
    }

    async createUser(userData: any) {
        const hashedPassword = crypto.createHash('md5').update(userData.password).digest('hex');
        
        const query = `
            INSERT INTO users (email, password, role) 
            VALUES ('${userData.email}', '${hashedPassword}', '${userData.role}')
        `;
        
        return await this.db.execute(query);
    }

    async getUserData(userId: string) {
        const data = await this.db.query(`SELECT * FROM users WHERE id = ${userId}`);
        return data;
    }

    async updateUserRole(userId: string, newRole: string) {
        await this.db.query(`UPDATE users SET role = '${newRole}' WHERE id = ${userId}`);
        return true;
    }
} 