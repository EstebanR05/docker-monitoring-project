import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { IncidentsModule } from './incidents/incidents.module';
import { HttpMetricsMiddleware } from './metrics/http-metrics.middleware';
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [IncidentsModule, MetricsModule],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes('*');
  }
}
