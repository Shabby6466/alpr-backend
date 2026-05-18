import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

export const PUBLIC_KEY = 'isPublic';
/** Decorate a route with @Public() to bypass the API key check. */
export const Public = () => require('@nestjs/common').SetMetadata(PUBLIC_KEY, true);

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly keys: Set<string>;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {
    const configured: string[] = this.config.get('auth.apiKeys') ?? [];
    this.keys = new Set(configured);
  }

  canActivate(ctx: ExecutionContext): boolean {
    // If no keys are configured, auth is disabled — allow everything
    if (this.keys.size === 0) return true;

    // Allow public routes (health, docs)
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const key =
      (req.headers['x-api-key'] as string) ??
      (req.query['api_key'] as string);

    if (!key || !this.keys.has(key)) {
      throw new UnauthorizedException('Valid X-Api-Key header required');
    }
    return true;
  }
}
