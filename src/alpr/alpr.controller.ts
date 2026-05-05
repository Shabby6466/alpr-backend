import {
  Controller, Post, Get, Body, UploadedFile, UseInterceptors,
  Query, HttpCode, HttpStatus, ParseFilePipe, FileTypeValidator,
  MaxFileSizeValidator, Res, Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { AlprService } from './alpr.service';
import { DetectPlateDto, DetectPlateFromUrlDto, DetectStreamDto } from './dto/detect-plate.dto';
import { AlprResultDto, HealthDto } from './dto/plate-result.dto';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const VIDEO_MAX_SIZE = 1024 * 1024 * 1024; // 1GB

@ApiTags('ALPR')
@Controller('alpr')
export class AlprController {
  private readonly logger = new Logger(AlprController.name);
  constructor(private readonly alpr: AlprService) {}

  @Post('detect')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('image'))
  @ApiOperation({ summary: 'Detect license plates from an uploaded image file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: {
        image: { type: 'string', format: 'binary' },
        maxPlates: { type: 'integer', default: 10 },
        minQuality: { type: 'number', default: 0.3 },
        relativeMinSize: { type: 'number', default: 0.03 },
        region: { type: 'string', enum: ['NORTH_AMERICAN', 'EUROPEAN', 'PACIFIC'], default: 'NORTH_AMERICAN' },
        thumbnail: { type: 'boolean', default: true },
        ignorePartial: { type: 'boolean', default: true },
      },
    },
  })
  @ApiResponse({ status: 200, type: AlprResultDto })
  async detectFromFile(
    @UploadedFile(new ParseFilePipe({
      validators: [
        new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE }),
        new FileTypeValidator({ fileType: /image\/(jpeg|jpg|png|bmp|tiff)/ }),
      ],
    }))
    file: Express.Multer.File,
    @Query() params: DetectPlateDto,
  ): Promise<AlprResultDto> {
    return this.alpr.detectFromFile(file, params);
  }

  @Post('detect-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Detect license plates from a remote image URL' })
  @ApiBody({ type: DetectPlateFromUrlDto })
  @ApiResponse({ status: 200, type: AlprResultDto })
  async detectFromUrl(@Body() dto: DetectPlateFromUrlDto): Promise<AlprResultDto> {
    return this.alpr.detectFromUrl(dto);
  }

  @Post('detect-video')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('video'))
  @ApiOperation({ summary: 'Upload a video and stream frame-by-frame ALPR results via SSE' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['video'],
      properties: {
        video: { type: 'string', format: 'binary', description: 'Video file (mp4, avi, mov)' },
        region: { type: 'string', enum: ['NORTH_AMERICAN', 'EUROPEAN', 'PACIFIC'], default: 'NORTH_AMERICAN' },
        maxPlates: { type: 'integer', default: 100 },
        thumbnail: { type: 'boolean', default: true },
        frameStep: { type: 'integer', default: 15, description: 'Process every Nth frame' },
      },
    },
  })
  async detectVideo(
    @UploadedFile(new ParseFilePipe({
      validators: [new MaxFileSizeValidator({ maxSize: VIDEO_MAX_SIZE })],
    }))
    file: Express.Multer.File,
    @Query() params: DetectPlateDto,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    this.logger.log(`Video detection started: ${file.originalname} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    let frameCount = 0;
    try {
      for await (const frame of this.alpr.detectVideoStream(file, params)) {
        frameCount++;
        res.write(`event: detection\ndata: ${JSON.stringify(frame)}\n\n`);
      }
    } catch (err) {
      this.logger.error(`Video detection error after ${frameCount} frames`, err?.message);
      res.write(`event: error\ndata: ${JSON.stringify({ error: err?.message })}\n\n`);
    } finally {
      this.logger.log(`Video detection done: ${frameCount} detection frames emitted for ${file.originalname}`);
      res.write('event: done\ndata: {}\n\n');
      res.end();
    }
  }

  @Post('detect-stream')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Process a live video stream (RTSP/HTTP) and stream ALPR results via SSE' })
  @ApiBody({ type: DetectStreamDto })
  async detectStream(
    @Body() dto: DetectStreamDto,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { url, ...params } = dto;
    this.logger.log(`Live stream detection started: ${url}`);
    let frameCount = 0;
    try {
      for await (const frame of this.alpr.detectLiveStream(url, params)) {
        frameCount++;
        res.write(`event: detection\ndata: ${JSON.stringify(frame)}\n\n`);
      }
    } catch (err) {
      this.logger.error(`Stream detection error after ${frameCount} frames`, err?.message);
      res.write(`event: error\ndata: ${JSON.stringify({ error: err?.message })}\n\n`);
    } finally {
      this.logger.log(`Stream detection done: ${frameCount} detection frames emitted for ${url}`);
      res.write('event: done\ndata: {}\n\n');
      res.end();
    }
  }

  @Get('health')
  @ApiOperation({ summary: 'Check ROC SDK health' })
  @ApiResponse({ status: 200, type: HealthDto })
  health(): HealthDto {
    return this.alpr.health();
  }
}
