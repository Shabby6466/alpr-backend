import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber, IsBoolean, IsArray, ValidateNested, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class RoiZoneDto {
  @ApiProperty() @IsNumber() @Type(() => Number) x: number;
  @ApiProperty() @IsNumber() @Type(() => Number) y: number;
  @ApiProperty() @IsNumber() @Type(() => Number) width: number;
  @ApiProperty() @IsNumber() @Type(() => Number) height: number;
}

export class DetectPlateDto {
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @IsOptional() @IsNumber() @Min(1) @Max(100) @Type(() => Number)
  maxPlates?: number = 10;

  @ApiPropertyOptional({ default: 0.2 })
  @IsOptional() @IsNumber() @Type(() => Number)
  minQuality?: number = 0.2;

  @ApiPropertyOptional({ default: 0.02 })
  @IsOptional() @IsNumber() @Type(() => Number)
  relativeMinSize?: number = 0.02;

  @ApiPropertyOptional({
    description: 'Region for plate classification',
    enum: ['NORTH_AMERICAN', 'EUROPEAN', 'PACIFIC', 'ASIAN', 'MIDDLE_EASTERN', 'AFRICAN', 'SOUTH_AMERICAN'],
    default: 'NORTH_AMERICAN',
  })
  @IsOptional() @IsString()
  region?: string = 'NORTH_AMERICAN';

  @ApiPropertyOptional({ description: 'Regex filter for plate text patterns' })
  @IsOptional() @IsString()
  textFilter?: string = '';

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean() @Type(() => Boolean)
  thumbnail?: boolean = true;

  @ApiPropertyOptional({ default: false })
  @IsOptional() @IsBoolean() @Type(() => Boolean)
  ignorePartial?: boolean = false;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional() @IsNumber() @Type(() => Number)
  degrees?: number = 0;

  @ApiPropertyOptional({ default: 0.1 })
  @IsOptional() @IsNumber() @Type(() => Number)
  falseDetectionRate?: number = 0.1;

  @ApiPropertyOptional({ default: 5, minimum: 1, description: 'Process every Nth frame' })
  @IsOptional() @IsNumber() @Min(1) @Type(() => Number)
  frameStep?: number = 5;

  @ApiPropertyOptional({ type: [RoiZoneDto], description: 'Include only these zones (normalized 0.0–1.0 or pixel coords)' })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RoiZoneDto)
  roiInclude?: RoiZoneDto[];

  @ApiPropertyOptional({ type: [RoiZoneDto], description: 'Exclude these zones from detection' })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RoiZoneDto)
  roiExclude?: RoiZoneDto[];

  @ApiPropertyOptional({ description: 'Video session ID — groups frames for per-vehicle deduplication; flush with POST /api/alpr/sessions/:id/flush' })
  @IsOptional() @IsString()
  sessionId?: string;

  @ApiPropertyOptional({ description: 'Camera ID — when set, events are attributed to this camera (GPS, journey tracking, source=camera)' })
  @IsOptional() @IsString()
  cameraId?: string;

  @ApiPropertyOptional({ description: 'Camera display name (used alongside cameraId)' })
  @IsOptional() @IsString()
  cameraName?: string;
}

export class DetectPlateFromUrlDto extends DetectPlateDto {
  @ApiProperty({ example: 'https://example.com/car.jpg' })
  @IsString()
  imageUrl: string;
}

export class DetectStreamDto extends DetectPlateDto {
  @ApiProperty({ example: 'rtsp://admin:password@192.168.1.100:554/stream1' })
  @IsString()
  url: string;
}
