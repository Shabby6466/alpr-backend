import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateWatchlistDto {
  @ApiProperty() @IsString() plateText: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

export class UpdateWatchlistDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}
