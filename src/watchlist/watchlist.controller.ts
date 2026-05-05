import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Sse, MessageEvent } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Observable, map } from 'rxjs';
import { WatchlistService } from './watchlist.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateWatchlistDto, UpdateWatchlistDto } from './dto/watchlist.dto';

@ApiTags('Watchlist')
@Controller('watchlist')
export class WatchlistController {
  constructor(
    private readonly watchlist: WatchlistService,
    private readonly notifications: NotificationsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Add a plate to the watchlist' })
  create(@Body() dto: CreateWatchlistDto) {
    return this.watchlist.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List watchlist entries' })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean })
  findAll(@Query('activeOnly') activeOnly?: string) {
    return this.watchlist.findAll(activeOnly === 'true');
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update watchlist entry (toggle active, change reason)' })
  update(@Param('id') id: string, @Body() dto: UpdateWatchlistDto) {
    return this.watchlist.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a plate from the watchlist' })
  remove(@Param('id') id: string) {
    return this.watchlist.remove(id);
  }
}

@ApiTags('Alerts')
@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly watchlist: WatchlistService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List alerts' })
  @ApiQuery({ name: 'acknowledged', required: false, type: Boolean })
  getAlerts(@Query('acknowledged') acknowledged?: string) {
    const ack = acknowledged === undefined ? undefined : acknowledged === 'true';
    return this.watchlist.getAlerts(ack);
  }

  @Patch(':id/acknowledge')
  @ApiOperation({ summary: 'Acknowledge an alert' })
  acknowledge(@Param('id') id: string) {
    return this.watchlist.acknowledgeAlert(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an alert' })
  delete(@Param('id') id: string) {
    return this.watchlist.deleteAlert(id);
  }

  @Sse('stream')
  @ApiOperation({ summary: 'SSE stream of real-time watchlist alerts' })
  stream(): Observable<MessageEvent> {
    return this.notifications.alerts$.pipe(
      map((msg) => ({ data: JSON.stringify(msg.data), type: msg.type }) as MessageEvent),
    );
  }
}
