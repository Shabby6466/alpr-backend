import { Controller, Get, Delete, Param, Query, Sse, MessageEvent, Res } from '@nestjs/common';
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

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a detection event' })
  delete(@Param('id') id: string) {
    return this.events.delete(id);
  }
}
