import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    OneToOne,
    JoinColumn,
    OneToMany,
    JoinTable, ManyToMany
} from "typeorm";
import {Guild} from "./Guild";
import {Seed} from "./Seed";
import {Api} from "./Api";
import {defaultCipherList} from "constants";

@Entity()
export class Organization {

    @PrimaryGeneratedColumn()
    id: number;

    @Column({length: 12})
    guild: String;

    @Column()
    validation_is_mainnet: boolean;

    @CreateDateColumn()
    validation_date: Date;

    @Column({default: false})
    reg_location_ok: boolean;

    @Column({default: false})
    reg_website_ok: boolean;

    @Column({nullable: true})
    reg_website_ms: number;

    @Column({default: false})
    chains_json_ok: boolean;

    @Column({nullable: true})
    chains_json_ms: number;

    @Column({default: false})
    chains_json_access_control_header_ok: boolean;

    @Column({default: false})
    bpjson_found: boolean;

    @Column({default: false})
    bpjson_producer_account_name_ok: boolean;

    @Column({default: false})
    bpjson_candidate_name_ok: boolean;

    @Column({default: false})
    bpjson_website_ok: boolean;

    @Column({nullable: true})
    bpjson_website_ms: number;

    @Column({default: false})
    bpjson_code_of_conduct_ok: boolean;

    @Column({nullable: true})
    bpjson_code_of_conduct_ms: number;

    @Column({default: false})
    bpjson_ownership_disclosure_ok: boolean;

    @Column({nullable: true})
    bpjson_ownership_disclosure_ms: number;

    @Column({default: false})
    bpjson_email_ok: boolean;

    @Column({default: false})
    bpjson_branding_ok: boolean;

    @Column({default: false})
    bpjson_location_ok: boolean;

    @Column({default: false})
    bpjson_social_ok: boolean;

    @Column({default: false})
    nodes_producer_found: boolean;

    @ManyToMany(type => Seed, {eager: true})
    @JoinTable()
    nodes_seed: Seed[];

    @ManyToMany(type => Api, {eager: true})
    @JoinTable()
    nodes_api: Api[];

    @Column({default: false})
    bpjson_matches_onchain: boolean;
}
