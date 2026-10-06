import { Injectable } from '@nestjs/common';
import { RedisService } from '../../shared';

/**
 * Cache Redis des permissions par membership, versionné par `permissions_version` (pv) :
 * tout changement de rôle incrémente pv, la clé change, l'ancienne expire. Révocation instantanée
 * sans invalider les JWT (ADR-0007). Cache de token_version pour « déconnecter tous mes appareils ».
 */
@Injectable()
export class PermissionCache {
  private static readonly TTL = 600;
  private readonly local = new Map<string, { value: string[]; at: number }>();

  constructor(private readonly redis: RedisService) {}

  async get(membershipId: string, pv: number): Promise<string[] | null> {
    const key = `perms:${membershipId}:${pv}`;
    const l = this.local.get(key);
    if (l && Date.now() - l.at < 5_000) return l.value;
    try {
      const raw = await this.redis.client.get(key);
      if (!raw) return null;
      const value = JSON.parse(raw) as string[];
      this.local.set(key, { value, at: Date.now() });
      return value;
    } catch {
      return null;
    }
  }

  async set(membershipId: string, pv: number, permissions: string[]) {
    const key = `perms:${membershipId}:${pv}`;
    this.local.set(key, { value: permissions, at: Date.now() });
    try {
      await this.redis.client.set(key, JSON.stringify(permissions), 'EX', PermissionCache.TTL);
    } catch {
      /* fail-soft */
    }
  }

  async getTokenVersion(userId: string): Promise<number | null> {
    try {
      const v = await this.redis.client.get(`user:tv:${userId}`);
      return v === null ? null : Number(v);
    } catch {
      return null;
    }
  }
  async setTokenVersion(userId: string, tv: number) {
    try {
      await this.redis.client.set(`user:tv:${userId}`, String(tv), 'EX', 86_400);
    } catch {
      /* fail-soft */
    }
  }
}
