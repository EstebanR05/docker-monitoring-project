import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { Incident } from './incident.interface';

const MAX_INCIDENTS = 1000;

/**
 * In-memory service managing incident records.
 */
@Injectable()
export class IncidentsService {
  private readonly incidents: Incident[] = [];

  /**
   * Returns all stored incidents.
   */
  findAll(): Incident[] {
    return [...this.incidents];
  }

  /**
   * Finds an incident by its UUID or throws NotFoundException.
   */
  findOne(id: string): Incident {
    const incident = this.incidents.find((item) => item.id === id);
    if (!incident) {
      throw new NotFoundException(`Incident with id "${id}" not found`);
    }
    return incident;
  }

  /**
   * Creates and stores a new incident with a generated UUID and ISO 8601 timestamp.
   */
  create(dto: CreateIncidentDto): Incident {
    const incident: Incident = {
      id: randomUUID(),
      title: dto.title,
      description: dto.description,
      type: dto.type,
      zone: dto.zone,
      createdAt: new Date().toISOString(),
    };
    if (this.incidents.length >= MAX_INCIDENTS) {
      this.incidents.shift();
    }
    this.incidents.push(incident);
    return incident;
  }
}
