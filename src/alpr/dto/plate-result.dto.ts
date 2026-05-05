import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BoundingBoxDto {
  @ApiProperty() x: number;
  @ApiProperty() y: number;
  @ApiProperty() width: number;
  @ApiProperty() height: number;
  @ApiProperty() rotation: number;
}

export class PlateDto {
  @ApiProperty() text: string;
  @ApiProperty() confidence: number;
  @ApiProperty() quality: number;
  @ApiProperty() boundingBox: BoundingBoxDto;
  @ApiPropertyOptional() thumbnail?: string;
  @ApiPropertyOptional() region?: string;
  @ApiPropertyOptional() state?: string;
  @ApiPropertyOptional({ description: 'Matched registered person ID' }) personId?: string;
  @ApiPropertyOptional({ description: 'Matched registered person name' }) personName?: string;
}

export class FaceDto {
  @ApiProperty() confidence: number;
  @ApiProperty() quality: number;
  @ApiProperty() boundingBox: BoundingBoxDto;
  @ApiPropertyOptional() thumbnail?: string;
  @ApiPropertyOptional({ description: 'Matched person ID' }) personId?: string;
  @ApiPropertyOptional({ description: 'Matched person name' }) personName?: string;
  @ApiPropertyOptional() similarity?: number;
}

export class AlprResultDto {
  @ApiProperty() success: boolean;
  @ApiProperty() count: number;
  @ApiProperty({ type: [PlateDto] }) plates: PlateDto[];
  @ApiProperty({ type: [FaceDto] }) faces: FaceDto[];
  @ApiProperty() processingTimeMs: number;
}

export class CombinedResultDto {
  @ApiProperty() frameIndex: number;
  @ApiProperty({ type: [PlateDto] }) plates: PlateDto[];
  @ApiProperty({ type: [FaceDto] }) faces: FaceDto[];
  @ApiProperty() processingTimeMs: number;
}

export class HealthDto {
  @ApiProperty({ enum: ['ok', 'error'] }) status: 'ok' | 'error';
  @ApiProperty() rocInitialized: boolean;
  @ApiProperty() modelPath: string;
  @ApiPropertyOptional() error?: string;
}
