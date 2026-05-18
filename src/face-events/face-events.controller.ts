import { Controller, Get, Delete, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiSecurity } from '@nestjs/swagger';
import { FaceEventsService } from './face-events.service';

@ApiTags('Face Events')
@ApiSecurity('api-key')
@Controller('face-events')
export class FaceEventsController {
  constructor(private readonly service: FaceEventsService) {}

  @Get()
  @ApiOperation({ summary: 'List face detection events with optional filters' })
  @ApiQuery({ name: 'personId', required: false })
  @ApiQuery({ name: 'cameraId', required: false })
  @ApiQuery({ name: 'spoofOnly', required: false, type: Boolean })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async findAll(
    @Query('personId') personId?: string,
    @Query('cameraId') cameraId?: string,
    @Query('spoofOnly') spoofOnly?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const [data, total] = await this.service.findAll({
      personId,
      cameraId,
      spoofOnly: spoofOnly === 'true',
      startDate,
      endDate,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    });
    return { total, data };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a face event by ID' })
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
