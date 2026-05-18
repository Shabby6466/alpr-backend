import { Controller, Get, Delete, Param, Query, Sse, MessageEvent } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Observable, map } from 'rxjs';
import { EventsService } from './events.service';
import { NotificationsService } from '../notifications/notifications.service';

@ApiTags('Events')
@Controller('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all detection events' })
  @ApiQuery({ name: 'plate', required: false })
  @ApiQuery({ name: 'personId', required: false })
  @ApiQuery({ name: 'source', required: false })
  @ApiQuery({ name: 'cameraId', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async findAll(@Query() query: any) {
    const [data, total] = await this.events.findAll(query);
    return { total, data };
  }

  @Sse('stream')
  @ApiOperation({ summary: 'SSE stream of real-time detection events' })
  stream(): Observable<MessageEvent> {
    return this.notifications.events$.pipe(
      map((msg) => ({ data: JSON.stringify(msg.data), type: msg.type }) as MessageEvent),
    );
  }

  @Get('stats')
  @ApiOperation({ summary: 'Hourly detection counts for the given time window' })
  getStats(@Query('days') days?: string) {
    return this.events.getStats(days ? parseInt(days, 10) : 7);
  }

  @Get('top-plates')
  @ApiOperation({ summary: 'Most frequently seen license plates' })
  getTopPlates(@Query('limit') limit?: string) {
    return this.events.getTopPlates(limit ? parseInt(limit, 10) : 10);
  }

  @Get('top-persons')
  @ApiOperation({ summary: 'Most frequently identified persons' })
  getTopPersons(@Query('limit') limit?: string) {
    return this.events.getTopPersons(limit ? parseInt(limit, 10) : 10);
  }

  @Get('vehicle-stats')
  @ApiOperation({ summary: 'Vehicle make and color distribution' })
  getVehicleStats(@Query('days') days?: string) {
    return this.events.getVehicleStats(days ? parseInt(days, 10) : 30);
  }

  @Get('source-breakdown')
  @ApiOperation({ summary: 'Detection counts by source (image/video/stream/camera)' })
  getSourceBreakdown(@Query('days') days?: string) {
    return this.events.getSourceBreakdown(days ? parseInt(days, 10) : 7);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a detection event' })
  delete(@Param('id') id: string) {
    return this.events.delete(id);
  }
}
