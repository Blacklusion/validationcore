import { Entity, Column, CreateDateColumn, PrimaryColumn } from "typeorm";

/**
 * Storing the information about a guild, found on chain
 * Usually stays unchanged during validation. Changes are only made to a guild, if the information on chain changes
 */
@Entity()
export class Guild {
  @PrimaryColumn({ length: 12, unique: true })
  name: string;

  @CreateDateColumn()
  tracked_since: Date;

  @Column({ type: "smallint", nullable: true })
  location: number;

  @Column({ nullable: true })
  locationAlpha: string;

  @Column({ nullable: true })
  url: string;

  @Column({ nullable: true })
  url_logo_256: string;
}
