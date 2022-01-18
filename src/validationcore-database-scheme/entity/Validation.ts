import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, JoinTable, ManyToMany } from "typeorm";
import { NodeSeed } from "./NodeSeed";
import { NodeApi } from "./NodeApi";
import { NodeAtomic } from "./NodeAtomic";
import { NodeHyperion } from "./NodeHyperion";
import { NodeHistory } from "./NodeHistory";
import { NodeWallet } from "./NodeWallet";
import { HttpErrorType } from "../enum/HttpErrorType";
import { ValidationLevel } from "../enum/ValidationLevel";

/**
 * Stores the validation results of an organization validation
 * An organization validation contains all relations to corresponding NodeApi and Seed validations
 */
@Entity()
export class Validation {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "smallint", nullable: false })
  instance_id: number;

  @Column({ length: 12 })
  guild: string;

  @CreateDateColumn()
  validation_date: Date;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.ERROR })
  all_checks_ok: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  reg_location: number;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  reg_location_ok: ValidationLevel;



  @Column({ nullable: true })
  reg_website_url: string;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  reg_website_ok: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  reg_website_ms: number;

  @Column({ type: "smallint", nullable: true })
  reg_website_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN, nullable: true })
  reg_website_errortype: HttpErrorType;



  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  chains_json_ok: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  chains_json_ms: number;

  @Column({ type: "smallint", nullable: true })
  chains_json_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN, nullable: true })
  chains_json_errortype: HttpErrorType;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  chains_json_access_control_header_ok: ValidationLevel;



  @Column({ nullable: true })
  bpjson_path: string;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  bpjson_ok: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  bpjson_ms: number;

  @Column({ type: "smallint", nullable: true })
  bpjson_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN, nullable: true })
  bpjson_errortype: HttpErrorType;



  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  bpjson_producer_account_name_ok: ValidationLevel;

  @Column({ nullable: true })
  bpjson_producer_account_name_message: string;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  bpjson_candidate_name_ok: ValidationLevel;



  @Column({ nullable: true })
  bpjson_website_url: string;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  bpjson_website_ok: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  bpjson_website_ms: number;

  @Column({ type: "smallint", nullable: true })
  bpjson_website_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN, nullable: true })
  bpjson_website_errortype: HttpErrorType;



  @Column({ nullable: true })
  bpjson_code_of_conduct_url: string;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  bpjson_code_of_conduct_ok: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  bpjson_code_of_conduct_ms: number;

  @Column({ type: "smallint", nullable: true })
  bpjson_code_of_conduct_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN, nullable: true })
  bpjson_code_of_conduct_errortype: HttpErrorType;



  @Column({ nullable: true })
  bpjson_ownership_disclosure_url: string;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  bpjson_ownership_disclosure_ok: ValidationLevel;

  @Column({ type: "smallint", nullable: true })
  bpjson_ownership_disclosure_ms: number;

  @Column({ type: "smallint", nullable: true })
  bpjson_ownership_disclosure_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN, nullable: true })
  bpjson_ownership_disclosure_errortype: HttpErrorType;



  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  bpjson_email_ok: ValidationLevel;

  @Column({ nullable: true })
  bpjson_email_message: string;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  bpjson_github_user_ok: ValidationLevel;

  @Column({ nullable: true })
  bpjson_github_user_message: string;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  bpjson_chain_resources_ok: ValidationLevel;

  @Column({ nullable: true })
  bpjson_chain_resources_message: string;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  bpjson_other_resources_ok: ValidationLevel;

  @Column({ nullable: true })
  bpjson_other_resources_message: string;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  bpjson_branding_ok: ValidationLevel;

  @Column({ nullable: true })
  bpjson_branding_message: string;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  bpjson_location_ok: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  bpjson_social_ok: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  bpjson_matches_onchain: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  nodes_producer_found: ValidationLevel;

  @ManyToMany(() => NodeSeed, { eager: true })
  @JoinTable()
  nodes_seed: NodeSeed[];

  @ManyToMany(() => NodeApi, { eager: true })
  @JoinTable()
  nodes_api: NodeApi[];

  @ManyToMany(() => NodeWallet, { eager: true })
  @JoinTable()
  nodes_wallet: NodeWallet[];

  @ManyToMany(() => NodeHistory, { eager: true })
  @JoinTable()
  nodes_history: NodeHistory[];

  @ManyToMany(() => NodeHyperion, { eager: true })
  @JoinTable()
  nodes_hyperion: NodeHyperion[];

  @ManyToMany(() => NodeAtomic, { eager: true })
  @JoinTable()
  nodes_atomic: NodeAtomic[];
}
