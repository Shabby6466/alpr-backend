import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsBoolean, IsArray, Min, Max, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class RoiZoneDto {
  @ApiProperty() @IsNumber() x: number;
  @ApiProperty() @IsNumber() y: number;
  @ApiProperty() @IsNumber() width: number;
  @ApiProperty() @IsNumber() height: number;
}

export class CreateCameraDto {
  @ApiProperty() @IsString() name: string;
  @ApiProperty() @IsString() url: string;

  @ApiPropertyOptional({ default: 'NORTH_AMERICAN', enum: ['NORTH_AMERICAN', 'EUROPEAN', 'PACIFIC', 'ASIAN', 'MIDDLE_EASTERN', 'AFRICAN', 'SOUTH_AMERICAN'] })
  @IsOptional() @IsString()
  region?: string = 'NORTH_AMERICAN';

  @ApiPropertyOptional({ default: 5, minimum: 1 })
  @IsOptional() @IsNumber() @Min(1) @Max(30)
  @Type(() => Number)
  frameStep?: number = 5;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() zone?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Type(() => Number) lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Type(() => Number) lng?: number;

  @ApiPropertyOptional({ type: [RoiZoneDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RoiZoneDto)
  roiInclude?: RoiZoneDto[];

  @ApiPropertyOptional({ type: [RoiZoneDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RoiZoneDto)
  roiExclude?: RoiZoneDto[];
}

export class UpdateCameraDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() url?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() region?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) @Max(30) @Type(() => Number) frameStep?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() zone?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Type(() => Number) lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Type(() => Number) lng?: number;
  @ApiPropertyOptional({ type: [RoiZoneDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RoiZoneDto) roiInclude?: RoiZoneDto[];
  @ApiPropertyOptional({ type: [RoiZoneDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RoiZoneDto) roiExclude?: RoiZoneDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() testVideoPath?: string;
}
