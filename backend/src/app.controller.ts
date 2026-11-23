import { Controller, Get } from '@nestjs/common';

/**
 * Root and health-check HTTP endpoints.
 */
@Controller()
export class AppController {
  private getInstanceId(): string {
    return process.env.INSTANCE_ID || 'backend-local';
  }

  @Get()
  getRoot() {
    return {
      service: 'incident-api',
      instanceId: this.getInstanceId(),
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      instanceId: this.getInstanceId(),
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
