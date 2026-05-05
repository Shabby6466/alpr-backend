import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { Person } from './person.entity';
import { CreatePersonDto, UpdatePersonDto } from './dto/person.dto';
import { normalizePlate } from '../common/plate.util';
import { RocService } from '../roc/roc.service';

@Injectable()
export class PersonsService implements OnModuleInit {
  constructor(
    @InjectRepository(Person)
    private readonly repo: Repository<Person>,
    private readonly roc: RocService,
  ) { }

  async onModuleInit() {
    // Run sync in background so it doesn't block app startup
    setTimeout(() => this.syncGallery(), 1000);
  }

  async syncGallery() {
    try {
      const persons = await this.repo.find({ where: { faceTemplate: Not(IsNull()) } });
      console.log(`[PersonsService] Syncing ${persons.length} persons with face templates to ROC gallery`);
      await this.roc.clearGallery();
      for (const person of persons) {
        if (person.faceTemplate && person.faceTemplate.length > 512) {
          console.log(`[PersonsService] Enrolling face for ${person.name} (${person.id})`);
          await this.roc.enrollFace(person.id, person.faceTemplate);
        } else if (person.faceTemplate) {
          console.warn(`[PersonsService] Skipping ${person.name} — template too small (${person.faceTemplate.length} bytes), likely corrupt`);
        }
      }
      console.log(`[PersonsService] Gallery sync complete`);
    } catch (err) {
      console.error(`[PersonsService] Gallery sync failed:`, err);
    }
  }

  create(dto: CreatePersonDto): Promise<Person> {
    const person = this.repo.create({
      ...dto,
      plateNumbers: dto.plateNumbers.map(normalizePlate),
    });
    return this.repo.save(person);
  }

  findAll(): Promise<Person[]> {
    return this.repo.find({ order: { name: 'ASC' } });
  }

  async findOne(id: string): Promise<Person> {
    const person = await this.repo.findOne({ where: { id } });
    if (!person) throw new NotFoundException(`Person ${id} not found`);
    return person;
  }

  async update(id: string, dto: UpdatePersonDto): Promise<Person> {
    const person = await this.findOne(id);
    if (dto.plateNumbers) dto.plateNumbers = dto.plateNumbers.map(normalizePlate);
    Object.assign(person, dto);
    return this.repo.save(person);
  }

  async remove(id: string) {
    const person = await this.findOne(id);
    return this.repo.remove(person);
  }

  findByPlate(plateText: string): Promise<Person | null> {
    const normalized = normalizePlate(plateText);
    return this.repo
      .createQueryBuilder('p')
      .where(`p.plateNumbers LIKE :plate`, { plate: `%"${normalized}"%` })
      .getOne();
  }

  async enrollFace(id: string, fvBuffer: Buffer, thumbnail: string) {
    const person = await this.findOne(id);
    person.faceTemplate = fvBuffer;
    person.faceThumbnail = thumbnail;
    await this.repo.save(person);
    // Gallery enrollment is done by PersonsController before calling this
  }
}
