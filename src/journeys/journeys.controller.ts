import { Controller, Get, Param, Query, ParseIntPipe, DefaultValuePipe, Optional } from '@nestjs/common';
import { ApiTags, ApiQuery } from '@nestjs/swagger';
import { JourneysService } from './journeys.service';

@ApiTags('journeys')
@Controller('journeys')
export class JourneysController {
  constructor(private readonly service: JourneysService) {}

  @Get()
  @ApiQuery({ name: 'plate', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'closed'] })
  @ApiQuery({ name: 'cameraId', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  findAll(
    @Query('plate') plate?: string,
    @Query('status') status?: 'active' | 'closed',
    @Query('cameraId') cameraId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ) {
    return this.service.findAll({ plate, status, cameraId, startDate, endDate, limit, offset });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
