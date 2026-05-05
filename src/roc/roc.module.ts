import { Module } from '@nestjs/common';
import { RocService } from './roc.service';

@Module({
  providers: [RocService],
  exports: [RocService],
})
export class RocModule {}
