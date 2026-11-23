import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/**
 * Express middleware that tracks in-flight requests, total count, and duration
 * using normalized Express route patterns to keep metric cardinality bounded.
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metricsService: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startTime = process.hrtime.bigint();
    let inFlightDecremented = false;

    this.metricsService.incrementInFlight();

    const decrementOnce = () => {
      if (!inFlightDecremented) {
        inFlightDecremented = true;
        this.metricsService.decrementInFlight();
      }
    };

    res.on('finish', () => {
      decrementOnce();
      const durationSeconds =
        Number(process.hrtime.bigint() - startTime) / 1_000_000_000;
      const route =
        typeof req.route?.path === 'string' ? req.route.path : 'unmatched';
      this.metricsService.recordRequest(
        req.method,
        route,
        String(res.statusCode),
        durationSeconds,
      );
    });

    res.on('close', () => {
      decrementOnce();
    });

    next();
  }
}
