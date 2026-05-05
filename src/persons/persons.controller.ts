import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PersonsService } from './persons.service';
import { EventsService } from '../events/events.service';
import { CreatePersonDto, UpdatePersonDto } from './dto/person.dto';
import { RocService } from '../roc/roc.service';

@ApiTags('Persons')
@Controller('persons')
export class PersonsController {
  constructor(
    private readonly persons: PersonsService,
    private readonly events: EventsService,
    private readonly roc: RocService,
  ) { }

  @Post()
  @ApiOperation({ summary: 'Register a person with their plate number(s)' })
  create(@Body() dto: CreatePersonDto) {
    return this.persons.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all registered persons' })
  findAll() {
    return this.persons.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get person with their visit history' })
  async findOne(
    @Param('id') id: string,
    @Query('visitLimit') visitLimit?: string,
    @Query('visitOffset') visitOffset?: string,
  ) {
    const [person, visits] = await Promise.all([
      this.persons.findOne(id),
      this.events.findByPerson(id, parseInt(visitLimit ?? '100', 10), parseInt(visitOffset ?? '0', 10)),
    ]);
    return { ...person, visits };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update person details' })
  update(@Param('id') id: string, @Body() dto: UpdatePersonDto) {
    return this.persons.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a person' })
  remove(@Param('id') id: string) {
    return this.persons.remove(id);
  }

  @Post(':id/enroll-face')
  @ApiOperation({ summary: 'Enroll a face photo for a person' })
  @UseInterceptors(FileInterceptor('image'))
  async enrollFace(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No image provided');

    const templates = await this.roc.representFaceRaw(file.buffer, file.originalname);
    if (templates.length === 0) throw new BadRequestException('No face detected in image');

    const t = templates[0];
    const thumbnail = t.tn?.length > 0 ? Buffer.from(t.tn).toString('base64') : undefined;
    const serialized = this.roc.serializeTemplate(t);

    await this.roc.enrollFaceNative(id, t);
    await this.persons.enrollFace(id, serialized, thumbnail);
    return { success: true, message: 'Face enrolled successfully' };
  }
}
