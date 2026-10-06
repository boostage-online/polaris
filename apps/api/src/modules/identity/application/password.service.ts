import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/** argon2id, paramètres ADR-0008 (m = 64 Mo, t = 3, p = 4). */
@Injectable()
export class PasswordService {
  private readonly options: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 64 * 1024,
    timeCost: 3,
    parallelism: 4,
  };

  hash(password: string): Promise<string> {
    return argon2.hash(password, this.options);
  }

  async verify(hash: string | null, password: string): Promise<boolean> {
    if (!hash) {
      // Temps constant : on calcule quand même un hachage pour ne pas révéler l'absence de mot de passe.
      await argon2.hash(password, { ...this.options, timeCost: 1, memoryCost: 8 * 1024 });
      return false;
    }
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, this.options);
  }
}
