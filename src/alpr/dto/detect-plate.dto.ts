import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber, IsBoolean, IsArray, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class DetectPlateDto {
  @ApiPropertyOptional({
    description: 'Maximum number of plates to return',
    default: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  maxPlates?: number = 10;

  @ApiPropertyOptional({
    description: 'Minimum plate quality threshold (0.0 - 1.0)',
    default: 0.3,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  minQuality?: number = 0.3;

  @ApiPropertyOptional({
    description: 'Minimum plate size relative to image width (0.0 - 1.0)',
    default: 0.03,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  relativeMinSize?: number = 0.03;

  @ApiPropertyOptional({
    description: 'Region classification: NORTH_AMERICAN | EUROPEAN | PACIFIC',
    enum: ['NORTH_AMERICAN', 'EUROPEAN', 'PACIFIC'],
    default: 'NORTH_AMERICAN',
  })
  @IsOptional()
  @IsString()
  region?: 'NORTH_AMERICAN' | 'EUROPEAN' | 'PACIFIC' = 'NORTH_AMERICAN';

  @ApiPropertyOptional({
    description: 'Regex filter to match specific plate text patterns',
  })
  @IsOptional()
  @IsString()
  textFilter?: string = '';

  @ApiPropertyOptional({
    description: 'Return cropped thumbnail of each detected plate',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  thumbnail?: boolean = true;

  @ApiPropertyOptional({
    description: 'Skip plates that are only partially visible in the image',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  ignorePartial?: boolean = true;

  @ApiPropertyOptional({
    description: 'Allowed rotation angle in degrees',
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  degrees?: number = 0;

  @ApiPropertyOptional({
    description: 'False detection rate threshold (0.0 - 1.0)',
    default: 0.1,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  falseDetectionRate?: number = 0.1;

  @ApiPropertyOptional({
    description: 'Process every Nth frame of the video',
    default: 15,
    minimum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  frameStep?: number = 15;
}

export class DetectPlateFromUrlDto extends DetectPlateDto {
  @ApiProperty({
    description: 'Publicly accessible URL of the image to process',
    example: 'https://example.com/car.jpg',
  })
  @IsString()
  imageUrl: string;
}

export class DetectStreamDto extends DetectPlateDto {
  @ApiProperty({
    description: 'URL of the video stream (RTSP, HTTP, etc.)',
    example: 'rtsp://admin:password@192.168.1.100:554/stream1',
  })
  @IsString()
  url: string;
}
