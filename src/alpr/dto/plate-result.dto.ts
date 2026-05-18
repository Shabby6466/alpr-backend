import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BoundingBoxDto {
  @ApiProperty() x: number;
  @ApiProperty() y: number;
  @ApiProperty() width: number;
  @ApiProperty() height: number;
  @ApiProperty() rotation: number;
}

export class VehicleDto {
  @ApiPropertyOptional() make?: string;
  @ApiPropertyOptional() model?: string;
  @ApiPropertyOptional() color?: string;
  @ApiPropertyOptional() thumbnail?: string;
  @ApiProperty() confidence: number;
  @ApiProperty() boundingBox: BoundingBoxDto;
}

export class PlateDto {
  @ApiProperty() text: string;
  @ApiProperty() confidence: number;
  @ApiProperty() quality: number;
  @ApiProperty() boundingBox: BoundingBoxDto;
  @ApiPropertyOptional() thumbnail?: string;
  @ApiPropertyOptional() region?: string;
  @ApiPropertyOptional() state?: string;
  @ApiPropertyOptional() personId?: string;
  @ApiPropertyOptional() personName?: string;
  @ApiPropertyOptional() vehicleMake?: string;
  @ApiPropertyOptional() vehicleModel?: string;
  @ApiPropertyOptional() vehicleColor?: string;
  @ApiPropertyOptional() vehicleThumbnail?: string;
  @ApiPropertyOptional({ enum: ['left', 'right', 'stationary'] }) direction?: 'left' | 'right' | 'stationary';
}

export class FaceDto {
  @ApiProperty() confidence: number;
  @ApiProperty() quality: number;
  @ApiProperty() boundingBox: BoundingBoxDto;
  @ApiPropertyOptional() thumbnail?: string;
  @ApiPropertyOptional() personId?: string;
  @ApiPropertyOptional() personName?: string;
  @ApiPropertyOptional() similarity?: number;
  @ApiPropertyOptional() spoofScore?: number;
  @ApiPropertyOptional() spoofDetected?: boolean;
  @ApiPropertyOptional() occluded?: boolean;
}

export class AlprResultDto {
  @ApiProperty() success: boolean;
  @ApiProperty() count: number;
  @ApiProperty({ type: [PlateDto] }) plates: PlateDto[];
  @ApiProperty({ type: [FaceDto] }) faces: FaceDto[];
  @ApiProperty({ type: [VehicleDto] }) vehicles: VehicleDto[];
  @ApiProperty() processingTimeMs: number;
  @ApiProperty() gunDetected: boolean;
}

export class CombinedResultDto {
  @ApiProperty() frameIndex: number;
  @ApiProperty({ type: [PlateDto] }) plates: PlateDto[];
  @ApiProperty({ type: [FaceDto] }) faces: FaceDto[];
  @ApiProperty({ type: [VehicleDto] }) vehicles: VehicleDto[];
  @ApiProperty() processingTimeMs: number;
  @ApiProperty() gunDetected: boolean;
}

export class CapabilitiesDto {
  @ApiProperty() lpr: boolean;
  @ApiProperty() face: boolean;
  @ApiProperty() vehicle: boolean;
  @ApiProperty() gun: boolean;
}

export class HealthDto {
  @ApiProperty({ enum: ['ok', 'error'] }) status: 'ok' | 'error';
  @ApiProperty() rocInitialized: boolean;
  @ApiProperty() modelPath: string;
  @ApiProperty({ type: CapabilitiesDto }) capabilities: CapabilitiesDto;
  @ApiPropertyOptional() error?: string;
}
