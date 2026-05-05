import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsArray, IsOptional, ArrayNotEmpty } from 'class-validator';

export class CreatePersonDto {
  @ApiProperty() @IsString() name: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayNotEmpty() plateNumbers: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class UpdatePersonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() plateNumbers?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
