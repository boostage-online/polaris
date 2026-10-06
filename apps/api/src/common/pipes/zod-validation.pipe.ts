import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { AppError } from '../errors/app-error';

/** Valide body/query/params avec un schéma zod ; erreurs 422 structurées par champ. */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata) {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw AppError.validation(
      result.error.issues.map((i) => ({
        path: i.path.join('.') || '(root)',
        message: i.message,
        code: i.code,
      })),
    );
  }
}
