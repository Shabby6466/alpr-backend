import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Person } from './person.entity';
import { PersonsService } from './persons.service';
import { PersonsController } from './persons.controller';
import { EventsModule } from '../events/events.module';
import { RocModule } from '../roc/roc.module';

@Module({
  imports: [TypeOrmModule.forFeature([Person]), EventsModule, RocModule],
  providers: [PersonsService],
  controllers: [PersonsController],
  exports: [PersonsService],
})
export class PersonsModule {}
